require("dotenv").config();

module.exports = {
  expo: {
    name: "LiveNudge",
    slug: "Livenudge_v2",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "light",
    ios: {
      supportsTablet: true,
    },
    android: {
      adaptiveIcon: {
        backgroundColor: "#E6F4FE",
        foregroundImage: "./assets/android-icon-foreground.png",
        backgroundImage: "./assets/android-icon-background.png",
        monochromeImage: "./assets/android-icon-monochrome.png",
      },
    },
    web: {
      favicon: "./assets/favicon.png",
    },
    extra: {
      sarvamApiKey: process.env.SARVAM_API_KEY || "",
    },
    plugins: ["expo-audio", "expo-asset", "expo-font"],
  },
};
