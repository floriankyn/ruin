import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {
    resolveAlias: {
      // mapbox-gl-draw references mapbox-gl internally; alias it to maplibre-gl
      "mapbox-gl": "maplibre-gl",
    },
  },
};

export default nextConfig;
