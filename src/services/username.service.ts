import {
  uniqueNamesGenerator,
  adjectives,
  animals,
  colors,
  NumberDictionary,
} from "unique-names-generator";
import type { Repository } from "typeorm";
import { User } from "../database/entities/user.entity.js";

const numberDictionary = NumberDictionary.generate({ min: 100, max: 999 });

export class UsernameService {
  /**
   * Generates a candidate username using adjectives, animals/colors, and numbers.
   * Example: "swift_falcon_482", "cosmic_panther_109"
   */
  public static generateCandidateUsername(): string {
    const rawName = uniqueNamesGenerator({
      dictionaries: [adjectives, animals, numberDictionary],
      separator: "_",
      length: 3,
      style: "lowerCase",
    });

    // Clean any invalid characters, keep only alphanumeric and underscore
    return rawName.replace(/[^a-z0-9_]/g, "").slice(0, 30);
  }

  /**
   * Generates a random username and guarantees it is unique in the database.
   */
  public static async generateUniqueUsername(
    userRepository: Repository<User>,
    maxRetries = 10
  ): Promise<string> {
    for (let i = 0; i < maxRetries; i++) {
      const candidate = this.generateCandidateUsername();
      const exists = await userRepository.findOne({
        where: { username: candidate },
        select: { id: true },
      });

      if (!exists) {
        return candidate;
      }
    }

    // Fallback if 10 collisions occur (very rare): append timestamp suffix
    const fallbackCandidate = `user_${Date.now().toString(36)}_${Math.floor(Math.random() * 1000)}`;
    return fallbackCandidate;
  }

  /**
   * Checks if a custom username is already taken.
   */
  public static async isUsernameAvailable(
    username: string,
    userRepository: Repository<User>
  ): Promise<boolean> {
    const existing = await userRepository.findOne({
      where: { username: username.toLowerCase().trim() },
      select: { id: true },
    });
    return !existing;
  }

  /**
   * Validates username format: alphanumeric and underscore, 3 to 30 characters.
   */
  public static isValidFormat(username: string): boolean {
    const regex = /^[a-zA-Z0-9_]{3,30}$/;
    return regex.test(username);
  }
}
