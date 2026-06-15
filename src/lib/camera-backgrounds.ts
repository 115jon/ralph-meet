import { apiDelete, apiGet, apiUpload } from "@/lib/api-client";
export {
  CAMERA_BACKGROUND_ACCEPT,
  CAMERA_BACKGROUND_UPLOAD_LIMIT_BYTES,
  CAMERA_BACKGROUND_UPLOAD_LIMIT_MB,
  getCameraBackgroundValidationError,
  isSupportedCameraBackgroundMimeType,
} from "@/lib/camera-background-validation";

export interface CameraBackgroundAsset {
  id: string;
  name: string;
  url: string;
  contentType: string;
  sizeBytes: number;
  createdAt: number;
}

interface CameraBackgroundListResponse {
  backgrounds: CameraBackgroundAsset[];
}

export async function listCameraBackgrounds(): Promise<CameraBackgroundAsset[]> {
  const response = await apiGet<CameraBackgroundListResponse>("/api/camera-backgrounds");
  return response.backgrounds;
}

export async function uploadCameraBackground(file: File): Promise<CameraBackgroundAsset> {
  const formData = new FormData();
  formData.append("file", file);
  return apiUpload<CameraBackgroundAsset>("/api/camera-backgrounds", formData);
}

export async function deleteCameraBackground(id: string): Promise<void> {
  await apiDelete<{ ok: true }, { id: string }>("/api/camera-backgrounds", { id });
}
