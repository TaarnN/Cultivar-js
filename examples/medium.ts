import { seed } from "../src/index.ts";

const takePhoto = seed(
  async ($) => {
    const iso = $("iso", {
      type: "f64",
      range: [100, 25600],
      default: 400,
    });
    const shutter = $("shutter", {
      type: "f64",
      range: [1 / 8000, 30],
      default: 1 / 125,
    });
    const wb = $("wb", {
      type: "f64",
      range: [2800, 7500],
      default: 5200,
      tier: "texture",
    });

    $.rel("iso", "wb", { kind: "inhibit", weight: 0.2 });
    await $.check(
      "exposure-safe",
      () => !(iso > 12800 && shutter < 1 / 250),
      {
        message: "too noisy for this shutter",
        enforcement: "reject",
      },
    );

    return {
      iso,
      shutter,
      wb,
      simulatedNoise: Number((iso / 25600 + (1 / shutter) * 0.00001).toFixed(4)),
    };
  },
  { id: "photo.capture", version: "1" },
);

const photo = await takePhoto();
console.log("medium:photo", photo);
console.log("medium:seed", takePhoto.seed.meta);
console.log("medium:schema", takePhoto.schema({ internal: true }));
