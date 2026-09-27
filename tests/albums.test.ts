import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildTestApp, registerUser, getTempToken, bearer, uniqueHandle } from "./helpers.js";
import { FakeStorage } from "./fake-storage.js";

let app: FastifyInstance;
const storage = new FakeStorage();

type Session = Awaited<ReturnType<typeof registerUser>>;
const auth = (s: Session) => bearer(s.tokens.accessToken);

before(async () => {
  app = await buildTestApp({ storage });
});

after(async () => {
  await app?.close();
});

async function createAlbum(owner: Session, title = "Trip") {
  const res = await app.inject({ method: "POST", url: "/api/v1/albums", headers: auth(owner), payload: { title } });
  assert.equal(res.statusCode, 201, res.body);
  return res.json().data.album as { id: string; title: string; ownerId: string; role: string };
}

function jpeg(name: string, sizeBytes = 1024) {
  return { fileName: name, contentType: "image/jpeg", sizeBytes };
}

async function requestUploads(user: Session, albumId: string, files: ReturnType<typeof jpeg>[]) {
  return app.inject({
    method: "POST",
    url: `/api/v1/albums/${albumId}/uploads`,
    headers: auth(user),
    payload: { files },
  });
}

async function complete(user: Session, albumId: string, imageIds: string[]) {
  return app.inject({
    method: "POST",
    url: `/api/v1/albums/${albumId}/uploads/complete`,
    headers: auth(user),
    payload: { imageIds },
  });
}

/** Swipe-right selection → presigned uploads → PUT to S3 → confirm. Returns uploaded images. */
async function uploadImages(user: Session, albumId: string, names: string[]) {
  const res = await requestUploads(user, albumId, names.map((n) => jpeg(n)));
  assert.equal(res.statusCode, 201, res.body);
  const uploads = res.json().data.uploads as { imageId: string; upload: { fields: { key: string } } }[];
  for (const u of uploads) storage.put(u.upload.fields.key, 1024);
  const done = await complete(user, albumId, uploads.map((u) => u.imageId));
  assert.equal(done.statusCode, 200, done.body);
  return done.json().data.uploaded as { id: string; fileName: string; url: string; sortOrder: number }[];
}

async function getAlbum(user: Session, albumId: string) {
  return app.inject({ method: "GET", url: `/api/v1/albums/${albumId}`, headers: auth(user) });
}

async function addMember(owner: Session, albumId: string, username: string, role?: "viewer" | "editor") {
  return app.inject({
    method: "POST",
    url: `/api/v1/albums/${albumId}/members`,
    headers: auth(owner),
    payload: { username, ...(role ? { role } : {}) },
  });
}

describe("Albums", () => {
  it("creates an album owned by the caller", async () => {
    const owner = await registerUser(app);
    const album = await createAlbum(owner, "  Goa 2026  ");
    assert.equal(album.title, "Goa 2026");
    assert.equal(album.ownerId, owner.user.id);
    assert.equal(album.role, "owner");
  });

  it("requires a session access token", async () => {
    const none = await app.inject({ method: "POST", url: "/api/v1/albums", payload: { title: "x" } });
    assert.equal(none.statusCode, 401);

    const { tempToken } = await getTempToken(app);
    const temp = await app.inject({ method: "GET", url: "/api/v1/albums", headers: bearer(tempToken) });
    assert.equal(temp.statusCode, 401);
  });

  it("validates title and album id", async () => {
    const owner = await registerUser(app);
    const empty = await app.inject({ method: "POST", url: "/api/v1/albums", headers: auth(owner), payload: { title: " " } });
    assert.equal(empty.statusCode, 400);
    const badId = await app.inject({ method: "GET", url: "/api/v1/albums/not-a-uuid", headers: auth(owner) });
    assert.equal(badId.statusCode, 400);
  });

  it("hides albums from non-members with 404", async () => {
    const owner = await registerUser(app);
    const stranger = await registerUser(app);
    const album = await createAlbum(owner);
    assert.equal((await getAlbum(stranger, album.id)).statusCode, 404);
  });

  it("lists owned and shared albums with count, cover and role", async () => {
    const owner = await registerUser(app);
    const friend = await registerUser(app);
    const mine = await createAlbum(owner, "Mine");
    const theirs = await createAlbum(friend, "Theirs");
    await uploadImages(owner, mine.id, ["a.jpg", "b.jpg"]);
    await addMember(friend, theirs.id, owner.user.username);

    const res = await app.inject({ method: "GET", url: "/api/v1/albums", headers: auth(owner) });
    assert.equal(res.statusCode, 200);
    const albums = res.json().data.albums as any[];
    const m = albums.find((a) => a.id === mine.id);
    const t = albums.find((a) => a.id === theirs.id);
    assert.equal(m.role, "owner");
    assert.equal(m.imageCount, 2);
    assert.match(m.coverUrl, /^https:\/\/cdn\.example\.test\/albums\//);
    assert.equal(t.role, "viewer");
    assert.equal(t.imageCount, 0);
    assert.equal(t.coverUrl, null);
  });

  it("owner can rename and set a cover from the album", async () => {
    const owner = await registerUser(app);
    const album = await createAlbum(owner);
    const [, second] = await uploadImages(owner, album.id, ["a.jpg", "b.jpg"]);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/albums/${album.id}`,
      headers: auth(owner),
      payload: { title: "Renamed", coverImageId: second.id },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().data.album.title, "Renamed");

    const list = await app.inject({ method: "GET", url: "/api/v1/albums", headers: auth(owner) });
    assert.equal(list.json().data.albums[0].coverUrl, second.url);

    const foreign = await app.inject({
      method: "PATCH",
      url: `/api/v1/albums/${album.id}`,
      headers: auth(owner),
      payload: { coverImageId: crypto.randomUUID() },
    });
    assert.equal(foreign.statusCode, 400);
  });

  it("owner deletes the album and its S3 objects; others cannot", async () => {
    const owner = await registerUser(app);
    const editor = await registerUser(app);
    const album = await createAlbum(owner);
    const images = await uploadImages(owner, album.id, ["a.jpg", "b.jpg"]);
    await addMember(owner, album.id, editor.user.username, "editor");

    const denied = await app.inject({ method: "DELETE", url: `/api/v1/albums/${album.id}`, headers: auth(editor) });
    assert.equal(denied.statusCode, 403);

    const res = await app.inject({ method: "DELETE", url: `/api/v1/albums/${album.id}`, headers: auth(owner) });
    assert.equal(res.statusCode, 200);
    assert.equal((await getAlbum(owner, album.id)).statusCode, 404);
    for (const img of images) {
      assert.ok(storage.deleted.some((k) => img.url.endsWith(k)), `S3 object for ${img.fileName} not deleted`);
    }
  });
});

describe("Swipe-selected uploads", () => {
  it("issues presigned S3 uploads in the order the images were swiped right", async () => {
    const owner = await registerUser(app);
    const album = await createAlbum(owner);
    const res = await requestUploads(owner, album.id, [jpeg("first.jpg"), { ...jpeg("second.png"), contentType: "image/png" }, jpeg("third.jpg")]);
    assert.equal(res.statusCode, 201, res.body);
    const uploads = res.json().data.uploads;
    assert.deepEqual(uploads.map((u: any) => u.fileName), ["first.jpg", "second.png", "third.jpg"]);
    assert.deepEqual(uploads.map((u: any) => u.sortOrder), [0, 1, 2]);
    assert.equal(uploads[0].upload.method, "POST");
    assert.equal(uploads[0].upload.fields.key, `albums/${album.id}/${uploads[0].imageId}.jpg`);
    assert.equal(uploads[1].upload.fields.key, `albums/${album.id}/${uploads[1].imageId}.png`);
    assert.equal(uploads[1].upload.fields["Content-Type"], "image/png");
  });

  it("pending images are hidden until confirmed; missing files are reported and retryable", async () => {
    const owner = await registerUser(app);
    const album = await createAlbum(owner);
    const res = await requestUploads(owner, album.id, [jpeg("a.jpg"), jpeg("b.jpg"), jpeg("c.jpg")]);
    const uploads = res.json().data.uploads as any[];
    const ids = uploads.map((u) => u.imageId);

    assert.equal((await getAlbum(owner, album.id)).json().data.images.length, 0);

    storage.put(uploads[0].upload.fields.key, 2048);
    storage.put(uploads[2].upload.fields.key, 4096);
    const partial = (await complete(owner, album.id, ids)).json();
    assert.equal(partial.success, false);
    assert.deepEqual(partial.data.uploaded.map((i: any) => i.fileName), ["a.jpg", "c.jpg"]);
    assert.equal(partial.data.uploaded[1].sizeBytes, 4096);
    assert.deepEqual(partial.data.failed, [{ imageId: ids[1], reason: "File was not uploaded" }]);

    storage.put(uploads[1].upload.fields.key, 1000);
    const retry = (await complete(owner, album.id, [ids[1]])).json();
    assert.equal(retry.success, true);

    const images = (await getAlbum(owner, album.id)).json().data.images;
    assert.deepEqual(images.map((i: any) => i.fileName), ["a.jpg", "b.jpg", "c.jpg"]);
    assert.ok(images.every((i: any) => i.url.startsWith("https://cdn.example.test/albums/")));
  });

  it("complete is idempotent", async () => {
    const owner = await registerUser(app);
    const album = await createAlbum(owner);
    const [img] = await uploadImages(owner, album.id, ["a.jpg"]);
    const again = (await complete(owner, album.id, [img.id])).json();
    assert.equal(again.success, true);
    assert.equal(again.data.uploaded[0].id, img.id);
    assert.equal((await getAlbum(owner, album.id)).json().data.images.length, 1);
  });

  it("rejects and deletes an object whose content type doesn't match", async () => {
    const owner = await registerUser(app);
    const album = await createAlbum(owner);
    const [u] = (await requestUploads(owner, album.id, [jpeg("a.jpg")])).json().data.uploads;
    storage.put(u.upload.fields.key, 100, "text/html");
    const res = (await complete(owner, album.id, [u.imageId])).json();
    assert.equal(res.data.failed[0].reason, "Uploaded file does not match the requested image");
    assert.ok(storage.deleted.includes(u.upload.fields.key));
    // The reservation is gone too
    assert.equal((await complete(owner, album.id, [u.imageId])).json().data.failed[0].reason, "Unknown upload");
  });

  it("cannot confirm another user's reservation", async () => {
    const owner = await registerUser(app);
    const editor = await registerUser(app);
    const album = await createAlbum(owner);
    await addMember(owner, album.id, editor.user.username, "editor");
    const [u] = (await requestUploads(owner, album.id, [jpeg("a.jpg")])).json().data.uploads;
    storage.put(u.upload.fields.key, 100);
    const res = (await complete(editor, album.id, [u.imageId])).json();
    assert.equal(res.data.failed[0].reason, "Unknown upload");
  });

  it("new batches are appended after existing images", async () => {
    const owner = await registerUser(app);
    const album = await createAlbum(owner);
    await uploadImages(owner, album.id, ["a.jpg", "b.jpg"]);
    const next = await uploadImages(owner, album.id, ["c.jpg"]);
    assert.equal(next[0].sortOrder, 2);
  });

  it("concurrent batches get distinct sort orders", async () => {
    const owner = await registerUser(app);
    const album = await createAlbum(owner);
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => requestUploads(owner, album.id, [jpeg(`${i}a.jpg`), jpeg(`${i}b.jpg`)]))
    );
    const orders = results.flatMap((r) => r.json().data.uploads.map((u: any) => u.sortOrder));
    assert.equal(new Set(orders).size, 10);
  });

  for (const [label, files, message] of [
    ["no files", [], "Select at least one image"],
    ["a PDF", [{ fileName: "doc.pdf", contentType: "application/pdf", sizeBytes: 10 }], undefined],
    ["an oversized image", [jpeg("big.jpg", 21 * 1024 * 1024)], undefined],
    ["an empty file", [jpeg("zero.jpg", 0)], "File cannot be empty"],
    ["more than 50 files", Array.from({ length: 51 }, (_, i) => jpeg(`${i}.jpg`)), undefined],
  ] as const) {
    it(`rejects ${label}`, async () => {
      const owner = await registerUser(app);
      const album = await createAlbum(owner);
      const res = await requestUploads(owner, album.id, files as any);
      assert.equal(res.statusCode, 400);
      if (message) assert.equal(res.json().message, message);
    });
  }

  it("viewers cannot upload; strangers get 404", async () => {
    const owner = await registerUser(app);
    const viewer = await registerUser(app);
    const stranger = await registerUser(app);
    const album = await createAlbum(owner);
    await addMember(owner, album.id, viewer.user.username);
    assert.equal((await requestUploads(viewer, album.id, [jpeg("a.jpg")])).statusCode, 403);
    assert.equal((await requestUploads(stranger, album.id, [jpeg("a.jpg")])).statusCode, 404);
  });
});

describe("Ordering and deleting images", () => {
  it("reorders images", async () => {
    const owner = await registerUser(app);
    const album = await createAlbum(owner);
    const [a, b, c] = await uploadImages(owner, album.id, ["a.jpg", "b.jpg", "c.jpg"]);
    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/albums/${album.id}/images/order`,
      headers: auth(owner),
      payload: { imageIds: [c.id, a.id, b.id] },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json().data.images.map((i: any) => i.fileName), ["c.jpg", "a.jpg", "b.jpg"]);
  });

  for (const [label, pick] of [
    ["a missing image", (ids: string[]) => ids.slice(0, 2)],
    ["a duplicate id", (ids: string[]) => [ids[0], ids[0], ids[1]]],
    ["a foreign id", (ids: string[]) => [ids[0], ids[1], crypto.randomUUID()]],
  ] as const) {
    it(`rejects reorder with ${label}`, async () => {
      const owner = await registerUser(app);
      const album = await createAlbum(owner);
      const ids = (await uploadImages(owner, album.id, ["a.jpg", "b.jpg", "c.jpg"])).map((i) => i.id);
      const res = await app.inject({
        method: "PUT",
        url: `/api/v1/albums/${album.id}/images/order`,
        headers: auth(owner),
        payload: { imageIds: pick(ids) },
      });
      assert.equal(res.statusCode, 400);
    });
  }

  it("deletes an image from S3 and clears it as cover", async () => {
    const owner = await registerUser(app);
    const album = await createAlbum(owner);
    const [a, b] = await uploadImages(owner, album.id, ["a.jpg", "b.jpg"]);
    await app.inject({ method: "PATCH", url: `/api/v1/albums/${album.id}`, headers: auth(owner), payload: { coverImageId: a.id } });

    const res = await app.inject({ method: "DELETE", url: `/api/v1/albums/${album.id}/images/${a.id}`, headers: auth(owner) });
    assert.equal(res.statusCode, 200);
    assert.ok(storage.deleted.some((k) => a.url.endsWith(k)));

    const data = (await getAlbum(owner, album.id)).json().data;
    assert.deepEqual(data.images.map((i: any) => i.id), [b.id]);
    assert.equal(data.album.coverImageId, null);

    const again = await app.inject({ method: "DELETE", url: `/api/v1/albums/${album.id}/images/${a.id}`, headers: auth(owner) });
    assert.equal(again.statusCode, 404);
  });
});

describe("Friends in a collection", () => {
  it("owner adds a friend by username; the friend can view it", async () => {
    const owner = await registerUser(app);
    const friend = await registerUser(app, { username: uniqueHandle("friend") });
    const album = await createAlbum(owner);
    await uploadImages(owner, album.id, ["a.jpg"]);

    const res = await addMember(owner, album.id, friend.user.username.toUpperCase());
    assert.equal(res.statusCode, 201, res.body);
    assert.equal(res.json().data.member.role, "viewer");

    const view = await getAlbum(friend, album.id);
    assert.equal(view.statusCode, 200);
    assert.equal(view.json().data.album.role, "viewer");
    assert.equal(view.json().data.images.length, 1);
    assert.deepEqual(
      view.json().data.members.map((m: any) => [m.username, m.role]),
      [[owner.user.username, "owner"], [friend.user.username, "viewer"]]
    );
  });

  it("rejects duplicate, unknown and self adds", async () => {
    const owner = await registerUser(app);
    const friend = await registerUser(app);
    const album = await createAlbum(owner);
    await addMember(owner, album.id, friend.user.username);
    assert.equal((await addMember(owner, album.id, friend.user.username)).statusCode, 409);
    assert.equal((await addMember(owner, album.id, uniqueHandle("ghost"))).statusCode, 404);
    assert.equal((await addMember(owner, album.id, owner.user.username)).statusCode, 400);
  });

  it("only the owner manages members", async () => {
    const owner = await registerUser(app);
    const editor = await registerUser(app);
    const other = await registerUser(app);
    const album = await createAlbum(owner);
    await addMember(owner, album.id, editor.user.username, "editor");
    assert.equal((await addMember(editor, album.id, other.user.username)).statusCode, 403);
  });

  it("promoting a viewer to editor lets them upload", async () => {
    const owner = await registerUser(app);
    const friend = await registerUser(app);
    const album = await createAlbum(owner);
    await addMember(owner, album.id, friend.user.username);
    assert.equal((await requestUploads(friend, album.id, [jpeg("x.jpg")])).statusCode, 403);

    const promote = await app.inject({
      method: "PATCH",
      url: `/api/v1/albums/${album.id}/members/${friend.user.id}`,
      headers: auth(owner),
      payload: { role: "editor" },
    });
    assert.equal(promote.statusCode, 200);
    const uploaded = await uploadImages(friend, album.id, ["x.jpg"]);
    assert.equal(uploaded.length, 1);
  });

  it("a member can leave; the owner can remove members but not leave", async () => {
    const owner = await registerUser(app);
    const a = await registerUser(app);
    const b = await registerUser(app);
    const album = await createAlbum(owner);
    await addMember(owner, album.id, a.user.username);
    await addMember(owner, album.id, b.user.username);

    const leave = await app.inject({ method: "DELETE", url: `/api/v1/albums/${album.id}/members/${a.user.id}`, headers: auth(a) });
    assert.equal(leave.statusCode, 200);
    assert.equal((await getAlbum(a, album.id)).statusCode, 404);

    const kick = await app.inject({ method: "DELETE", url: `/api/v1/albums/${album.id}/members/${b.user.id}`, headers: auth(owner) });
    assert.equal(kick.statusCode, 200);
    assert.equal((await getAlbum(b, album.id)).statusCode, 404);

    const ownerLeave = await app.inject({ method: "DELETE", url: `/api/v1/albums/${album.id}/members/${owner.user.id}`, headers: auth(owner) });
    assert.equal(ownerLeave.statusCode, 400);
  });
});

describe("Public share links", () => {
  async function createLink(user: Session, albumId: string, payload?: object) {
    return app.inject({
      method: "POST",
      url: `/api/v1/albums/${albumId}/share-links`,
      headers: auth(user),
      ...(payload ? { payload } : {}),
    });
  }
  const viewShared = (token: string) => app.inject({ method: "GET", url: `/api/v1/shared/${token}` });

  it("anyone with the link sees the album's images in order via the CDN", async () => {
    const owner = await registerUser(app);
    const album = await createAlbum(owner, "Wedding");
    const [a, b] = await uploadImages(owner, album.id, ["a.jpg", "b.jpg"]);
    await requestUploads(owner, album.id, [jpeg("pending.jpg")]); // never uploaded → not shown

    const res = await createLink(owner, album.id);
    assert.equal(res.statusCode, 201, res.body);
    const link = res.json().data.link;
    assert.equal(link.url, `https://app.example.test/s/${link.token}`);
    assert.equal(link.expiresAt, null);

    const view = await viewShared(link.token);
    assert.equal(view.statusCode, 200, view.body);
    const data = view.json().data;
    assert.equal(data.album.title, "Wedding");
    assert.equal(data.album.ownerUsername, owner.user.username);
    assert.deepEqual(data.images.map((i: any) => i.url), [a.url, b.url]);
    assert.ok(data.images.every((i: any) => !("uploaderId" in i)));

    await viewShared(link.token);
    const links = await app.inject({ method: "GET", url: `/api/v1/albums/${album.id}/share-links`, headers: auth(owner) });
    assert.equal(links.json().data.links[0].viewCount, 2);
  });

  it("expired links return 410", async () => {
    const owner = await registerUser(app);
    const album = await createAlbum(owner);
    const link = (await createLink(owner, album.id, { expiresInHours: 1 })).json().data.link;
    assert.ok(new Date(link.expiresAt).getTime() > Date.now());
    await app.db.query(`UPDATE share_links SET "expiresAt" = NOW() - INTERVAL '1 minute' WHERE id = $1`, [link.id]);
    assert.equal((await viewShared(link.token)).statusCode, 410);
  });

  it("revoked links stop working", async () => {
    const owner = await registerUser(app);
    const album = await createAlbum(owner);
    const link = (await createLink(owner, album.id)).json().data.link;
    const revoke = await app.inject({ method: "DELETE", url: `/api/v1/albums/${album.id}/share-links/${link.id}`, headers: auth(owner) });
    assert.equal(revoke.statusCode, 200);
    assert.equal((await viewShared(link.token)).statusCode, 404);
    const again = await app.inject({ method: "DELETE", url: `/api/v1/albums/${album.id}/share-links/${link.id}`, headers: auth(owner) });
    assert.equal(again.statusCode, 404);
  });

  it("deleting the album kills its links", async () => {
    const owner = await registerUser(app);
    const album = await createAlbum(owner);
    const link = (await createLink(owner, album.id)).json().data.link;
    await app.inject({ method: "DELETE", url: `/api/v1/albums/${album.id}`, headers: auth(owner) });
    assert.equal((await viewShared(link.token)).statusCode, 404);
  });

  it("viewers cannot create links", async () => {
    const owner = await registerUser(app);
    const viewer = await registerUser(app);
    const album = await createAlbum(owner);
    await addMember(owner, album.id, viewer.user.username);
    assert.equal((await createLink(viewer, album.id)).statusCode, 403);
  });

  it("validates tokens and expiry", async () => {
    assert.equal((await viewShared("bad!token")).statusCode, 400);
    assert.equal((await viewShared("A".repeat(32))).statusCode, 404);
    const owner = await registerUser(app);
    const album = await createAlbum(owner);
    assert.equal((await createLink(owner, album.id, { expiresInHours: 0 })).statusCode, 400);
  });
});
