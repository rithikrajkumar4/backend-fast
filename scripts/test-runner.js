import { buildApp } from "../src/app.js";

async function runAllTests() {
  console.log("==========================================");
  console.log("🧪 Starting Automated Container Test Suite");
  console.log("==========================================\n");

  const app = await buildApp({ logger: false });
  await app.ready();
  console.log("✅ Fastify test server initialized and connected to Database.");

  const randomSuffix = Math.floor(1000000 + Math.random() * 9000000);
  const testPhone = `+1555${randomSuffix}`;
  const customHandle = `user_docker_${Math.floor(1000 + Math.random() * 9000)}`;

  try {
    // 1. Health check
    console.log("▶ [Test 1] Health Check Endpoint");
    const healthRes = await app.inject({ method: "GET", url: "/health" });
    if (healthRes.statusCode !== 200) throw new Error(`Health check failed: ${healthRes.statusCode}`);
    console.log("  ✓ Health check passed (200 OK)");

    // 2. Send OTP for New User
    console.log("▶ [Test 2] Send OTP for New User");
    const sendOtpRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/send-otp",
      payload: { phoneNumber: testPhone },
    });
    if (sendOtpRes.statusCode !== 200) throw new Error(`Send OTP failed: ${sendOtpRes.body}`);
    const sendOtpData = JSON.parse(sendOtpRes.body);
    if (!sendOtpData.data.isNewUser) throw new Error("Expected isNewUser: true");
    console.log(`  ✓ OTP sent for new user: ${sendOtpData.data.otp}`);

    // 3. Verify OTP for New User (App Client)
    console.log("▶ [Test 3] Verify OTP & Suggest Collision-Free Username");
    const verifyRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-otp",
      headers: { "x-client-type": "app" },
      payload: { phoneNumber: testPhone, otp: sendOtpData.data.otp, clientType: "app" },
    });
    if (verifyRes.statusCode !== 200) throw new Error(`Verify OTP failed: ${verifyRes.body}`);
    const verifyData = JSON.parse(verifyRes.body);
    if (!verifyData.data.suggestedUsername || !verifyData.data.tempToken) {
      throw new Error("Missing suggestedUsername or tempToken");
    }
    console.log(`  ✓ OTP verified. Suggested username: '${verifyData.data.suggestedUsername}'`);

    // 4. Complete Registration / Profile
    console.log("▶ [Test 4] Complete Profile Registration with Custom Handle");
    const completeRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/complete-profile",
      headers: { "x-client-type": "app" },
      payload: {
        tempToken: verifyData.data.tempToken,
        name: "Docker Test User",
        age: 26,
        username: customHandle,
        clientType: "app",
      },
    });
    if (completeRes.statusCode !== 201) throw new Error(`Complete profile failed: ${completeRes.body}`);
    const completeData = JSON.parse(completeRes.body);
    const { accessToken, refreshToken, sessionId } = completeData.data.tokens;
    console.log(`  ✓ Profile created: ID '${completeData.data.user.id}', Session '${sessionId}'`);

    // 5. Authenticated Profile Fetch
    console.log("▶ [Test 5] Fetch Authenticated Profile (/me)");
    const meRes = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "x-request-id": "docker-test-req-001",
      },
    });
    if (meRes.statusCode !== 200) throw new Error(`Fetch me failed: ${meRes.body}`);
    console.log("  ✓ Authenticated /me response verified");

    // 6. Username Collision / Conflict Test
    console.log("▶ [Test 6] Verify 409 Conflict on Taken Username");
    const dupSend = await app.inject({
      method: "POST",
      url: "/api/v1/auth/send-otp",
      payload: { phoneNumber: `+1555${Math.floor(1000000 + Math.random() * 9000000)}` },
    });
    const dupSendData = JSON.parse(dupSend.body);
    const dupVerify = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-otp",
      payload: { phoneNumber: dupSendData.data.phoneNumber, otp: dupSendData.data.otp },
    });
    const dupVerifyData = JSON.parse(dupVerify.body);

    const conflictRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/complete-profile",
      payload: {
        tempToken: dupVerifyData.data.tempToken,
        name: "Conflict Attempt",
        age: 30,
        username: customHandle, // Duplicate handle
      },
    });
    if (conflictRes.statusCode !== 409) throw new Error(`Expected 409 Conflict, got ${conflictRes.statusCode}`);
    console.log("  ✓ Duplicate username properly rejected with 409 Conflict");

    // 7. Refresh Token Flow
    console.log("▶ [Test 7] Refresh Token & Session Rotation");
    const refreshRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh-token",
      payload: { refreshToken },
    });
    if (refreshRes.statusCode !== 200) throw new Error(`Refresh token failed: ${refreshRes.body}`);
    const refreshData = JSON.parse(refreshRes.body);
    console.log("  ✓ Refresh token rotated successfully");

    // 8. Logout / Session Revocation
    console.log("▶ [Test 8] Session Revocation (Logout)");
    const logoutRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { authorization: `Bearer ${refreshData.data.tokens.accessToken}` },
    });
    if (logoutRes.statusCode !== 200) throw new Error(`Logout failed: ${logoutRes.body}`);
    console.log("  ✓ Session revoked successfully");

    console.log("\n==========================================");
    console.log("🎉 ALL TESTS PASSED SUCCESSFULLY IN DOCKER!");
    console.log("==========================================\n");

    await app.close();
    process.exit(0);
  } catch (err) {
    console.error("\n❌ Test Suite Failed with Error:\n", err);
    await app.close();
    process.exit(1);
  }
}

runAllTests();
