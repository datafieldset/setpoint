// app/api/auth/[...nextauth]/route.js
// Auth.js's required route handler. All the real config lives in auth.js at
// the project root; this file just wires it into the App Router.

import { handlers } from "../../../../auth.js";

export const { GET, POST } = handlers;
