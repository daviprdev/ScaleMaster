import { ImageResponse } from "next/og";
import { brandLogoBase64 } from "@/lib/brand-logo";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default async function Icon() {
  // Read the actual logo file
  const logoBase64 = await brandLogoBase64();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#001244",
          borderRadius: 6,
        }}
      >
        <img
          src={`data:image/jpeg;base64,${logoBase64}`}
          width={28}
          height={28}
          style={{ objectFit: "contain" }}
        />
      </div>
    ),
    { ...size }
  );
}