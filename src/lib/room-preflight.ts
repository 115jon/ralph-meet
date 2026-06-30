export function getRoomPreflightWarnings(devices: Pick<MediaDeviceInfo, "kind">[]) {
  const hasMicrophone = devices.some((device) => device.kind === "audioinput");
  return hasMicrophone ? [] : ["No microphone detected"];
}
