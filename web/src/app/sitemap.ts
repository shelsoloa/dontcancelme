import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: "https://dontcancel.me", lastModified: new Date() },
    { url: "https://dontcancel.me/login", lastModified: new Date() },
    { url: "https://dontcancel.me/start", lastModified: new Date() },
    { url: "https://dontcancel.me/privacy", lastModified: new Date() },
    { url: "https://dontcancel.me/terms", lastModified: new Date() },
  ];
}
