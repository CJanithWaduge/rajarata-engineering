/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    authUser?: {
      uid: string;
      email?: string;
      name?: string;
      admin: true;
    };
  }
}
