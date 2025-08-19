import { Router } from "express";
import { UserController } from "../controllers/user.controller";

const router = Router();

// GET /api/user/info - Get current user information
router.get("/info", UserController.getCurrentUser);

export default router;
