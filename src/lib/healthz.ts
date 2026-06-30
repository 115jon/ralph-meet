import packageJson from "../../package.json";

type Clock = () => Date;

export function buildHealthzPayload(now: Clock = () => new Date()) {
  return {
    ok: true,
    service: "ralph-meet",
    version: packageJson.version,
    checkedAt: now().toISOString(),
  };
}
