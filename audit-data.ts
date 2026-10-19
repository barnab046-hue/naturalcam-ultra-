export const SPARK40 = {
  name: "TECNO Spark 40",
  distinguishedFrom: "Spark 40 5G and Spark 40 Pro are different phones and are not assumed here.",
  published: [
    ["Rear camera", "50MP, dual-LED flash. Official page does not publish aperture, sensor size, or OIS."],
    ["Front camera", "8MP, dual-LED flash."],
    ["Video, secondary sources", "1440p and 1080p at 30fps are listed by GSMArena. 4K is not."],
    ["Autofocus", "PDAF is listed by GSMArena for the rear camera. The front camera is not described as having autofocus."],
    ["Zoom", "No optical zoom is published. An auxiliary lens is not treated as a telephoto."],
    ["System", "Android 15 with HiOS 15. Helio G81, or Helio G91 on the NFC variant."],
    ["Display", "6.67-inch 720×1600 IPS, 120Hz."],
    ["Motion sensors", "TECNO lists a software gyroscope, not a hardware gyro spec."],
  ],
  withheld: [
    "Camera2 hardware level (LEGACY, LIMITED, FULL, or LEVEL_3)",
    "RAW / DNG support and raw resolutions",
    "ISO range and shutter range",
    "Manual white balance and Kelvin control",
    "Optical stabilization — none is published, and none is assumed",
    "Night, HDR, or bokeh camera extensions",
    "Whether hardware burst capture is actually advertised by the HAL",
  ],
  sources: [
    { label: "TECNO official specs", href: "https://www.tecno-mobile.com/phones/tech-specs/techspecs/spark-40/" },
    { label: "GSMArena Spark 40", href: "https://www.gsmarena.com/tecno_spark_40_4g-13984.php" },
  ],
} as const;
