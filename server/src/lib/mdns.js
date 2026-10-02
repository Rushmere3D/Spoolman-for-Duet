import { Bonjour } from "bonjour-service";

export function startMdnsAdvertisement({ port, version }) {
  const bonjour = new Bonjour();
  const service = bonjour.publish({
    name: "Spoolman for Duet Bridge",
    type: "spoolman-duet",
    protocol: "tcp",
    port,
    txt: {
      version,
      api: "v1"
    }
  });

  return {
    close() {
      service.stop(() => {
        bonjour.destroy();
      });
    }
  };
}
