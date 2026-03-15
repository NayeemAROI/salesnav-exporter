<div align="center">

# 🚀 SalesNav Exporter

**A powerful Chrome extension designed to help you extract leads directly from LinkedIn Sales Navigator and quickly analyze LinkedIn profiles for recent activity.**

[![Version](https://img.shields.io/badge/version-0.4.2-blue.svg)](manifest.json)
[![Status](https://img.shields.io/badge/status-Internal_Release-orange.svg)]()
[![Platform](https://img.shields.io/badge/platform-Chrome%20%7C%20Edge%20%7C%20Brave-lightgrey.svg)]()

<br/>

### 📥 [Download Latest Release (.ZIP)](https://github.com/NayeemAROI/salesnav-exporter/archive/refs/heads/main.zip)

</div>

---

## 📸 Preview

<p align="center">
  <img src="assets/preview1.png" alt="Scanner Config" width="250"/>
  <img src="assets/preview2.png" alt="Scanner Progress" width="250"/>
  <img src="assets/preview3.png" alt="Scanner Controls" width="250"/>
</p>

## ✨ Features

### 📊 1. List Exporter (Sales Navigator)
*Quickly export leads directly from Sales Navigator People search or Lead lists.*
- 🧭 Navigate to your Sales Navigator list.
- 🖱️ Click the extension icon and hit **Export Current Page** to download a CSV of the visible leads.

### 🔍 2. Deep Scanner (Profile Activity Checker)
*Analyze a list of LinkedIn profiles automatically to determine their activity status and premium tier.*
- 📋 Paste LinkedIn profile URLs (e.g., `linkedin.com/in/...`) into the scanner directly from the extension popup.
- 🎯 Set targeted filters:
  - **Min Connections**: Skip profiles below a specific connection count.
  - **Activity within X Months**: Define the timeframe to classify a profile as "active".
- 🤖 The scanner will automatically visit each profile's activity tabs, fetch the most recent activity, and determine if they are active.
- 📥 Download the results as a clean, ready-to-use CSV file.

### 📄 CSV Output Format
The generated CSV includes the following rich data points:
- 👤 **Name**
- 🔗 **Profile URL**
- ⚡ **Status** *(Active / Inactive)*
- 🌟 **Is Premium?** *(Yes / No)*
- 🤝 **Number of Connections**
- 🕒 **Last Activity** *(e.g., "2 Months", "1 Week", "3 Days")*

---

## 🛠️ Installation Guide (Developer Mode)

> **Note:** Since this extension is not published on the Chrome Web Store, you will need to install it manually using your browser's "Developer Mode". 

1. **Download the code 📂**: [Click here to download the extension as a .ZIP file](https://github.com/NayeemAROI/salesnav-exporter/archive/refs/heads/main.zip). Once downloaded, extract/unzip the file into a folder on your computer.
2. **Open Extensions Page 🌐**: Open your browser and navigate to the extensions page:
   - **Chrome**: `chrome://extensions`
   - **Edge**: `edge://extensions`
   - **Brave**: `brave://extensions`
3. **Enable Developer Mode ⚙️**: Look for the "Developer mode" toggle switch in the top-right corner of the extensions page and turn it **ON**.
4. **Load the Extension 📥**: Click the **"Load unpacked"** button that appears in the top-left corner.
5. **Select Folder 📁**: Select the `salesnav-exporter` folder (the directory containing the `manifest.json` file).
6. **Pin the Extension 📌**: The SalesNav Exporter icon will now appear in your browser toolbar (hidden under the puzzle piece icon). Click the puzzle piece and "Pin" the extension for easy access!

🎉 **You are now ready to go!** Head over to LinkedIn or LinkedIn Sales Navigator to start using the extension.

---

## 🔄 Updating the Extension

When a new version of the code is released:
1. ♻️ Replace the files in your local `salesnav-exporter` folder with the new versions.
2. 🔙 Go back to `chrome://extensions` (or your browser's equivalent).
3. 🔄 Find the *SalesNav Exporter* card and click the **Refresh** icon (the circular arrow button) to load the new changes.

---

## ⚠️ Usage Limits & Important Notes

- 🛑 **Scanner Quotas**: To prevent overwhelming LinkedIn and hitting restriction limits, the scanner is currently limited to:
  - Max **50 profiles** per scan session.
  - Max **100 profiles** per day *(resets at midnight)*.
- ✅ **Valid URLs**: The Deep Scanner only accepts standard LinkedIn profile URLs containing `linkedin.com/in/`. Invalid URLs will be automatically listed and excluded.
- 💼 **Requirements**: This extension requires an active LinkedIn Sales Navigator subscription for the List Exporter features.
- 🚨 **Disclaimer**: Use responsibly. Excessive automation may trigger LinkedIn account restrictions.
