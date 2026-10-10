import { ImageResponse } from "next/og";
import fs from "fs";
import path from "path";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  // Read the actual logo file
  const logoPath = path.join(process.cwd(), "public/brand/scale-master-logo.jpg");
  const logoData = fs.readFileSync(logoPath);
  const logoBase64 = logoData.toString("base64");

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