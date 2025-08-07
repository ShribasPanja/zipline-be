import { Router } from "express";
import { AuthController } from "../controllers/auth.controller";

const router = Router();

// GitHub OAuth routes
router.get("/github", AuthController.redirectToGitHub);
router.get("/github/callback", AuthController.handleGitHubCallback);

export default router;
