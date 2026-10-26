import type { MetadataRoute } from "next";

/** Lets the app be added to the phone home screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BF Personal App",
    short_name: "BF App",
    description: "Personal productivity and accountability.",
    start_url: "/",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#0f766e",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
