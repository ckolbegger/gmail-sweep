import { ApiClient } from "./api";
import { createTuiApp } from "./app";

const backendUrl = process.env.BACKEND_URL || "http://127.0.0.1:3000";
const apiClient = new ApiClient(backendUrl);

createTuiApp(apiClient);
