// User Entity DTOs

export interface CreateUserDto {
  phoneNumber: string;
  username: string;
  name: string;
  age: number;
  email?: string | null;
  isActive?: boolean;
}

export interface UpdateUserDto {
  name?: string;
  age?: number;
  email?: string | null;
  isActive?: boolean;
}

export interface UserResponseDto {
  id: string;
  phoneNumber: string | null;
  username: string;
  name: string;
  age: number;
  email?: string | null;
  emailVerified: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
