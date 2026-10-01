import { handlers } from "@/auth";

// Все OAuth-маршруты Auth.js: /api/auth/signin, /api/auth/callback/github, /api/auth/signout, /api/auth/session…
export const { GET, POST } = handlers;
