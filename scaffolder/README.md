# Scaffolder A to Z Training

Complete Scaffolding Training & Safety Guide — simple Bengali with English technical terms.
Developed by **MrTech** · https://Mrtech.nptrunamentbd.top

## বৈশিষ্ট্য (Features)
- মোবাইল-ফার্স্ট অ্যাপ, ডার্ক/লাইট মোড, লোডিং স্ক্রিন, সার্চ (বাংলা + English)
- হোম পেজে ঘুরানো 3D স্ক্যাফোল্ড; অংশ ছুঁলে নাম আসে (ও বলে)
- ৩০টি Parts কার্ড, ৮ রকম ক্ল্যাম্প, পাইপ ও পাট্টার মাপ, পাইপ ওজন ক্যালকুলেটর, লোড ক্যালকুলেটর
- Saudi Aramco GI 8.001 এর মূল নিয়ম (ট্যাগ, উচ্চতা, ইন্সপেকশন, সার্টিফিকেট)
- ৬৫টি কুইজ প্রশ্ন, টাইমারসহ পরীক্ষা, ৩৪টি ইন্টারভিউ প্রশ্ন-উত্তর
- পাঠ পড়ার সময় ফুল স্ক্রিন, প্রোগ্রেস/বুকমার্ক (localStorage), PWA (ইনস্টল + অফলাইন)

## ফাইল কাঠামো
```
index.html      পুরো অ্যাপ
manifest.json   PWA সেটিং (ফুল স্ক্রিন)
sw.js           অফলাইন ক্যাশ
icon-192.png, icon-512.png
img/parts/      আপনার ছবি: 01.jpg ... 30.jpg
.nojekyll
```

## GitHub Pages এ চালু করার ধাপ
1. GitHub এ নতুন repository খুলুন (যেমন `scaffolder-training`)।
2. এই ফোল্ডারের সব ফাইল (`.nojekyll` ও `img` সহ) আপলোড করুন।
3. Settings → Pages → Branch: `main` / root → Save।
4. কয়েক মিনিট পর লিংক পাবেন। ফোনে Chrome এ খুলে "Install app" / "Add to Home screen" দিন, আইকন থেকে ফুল স্ক্রিনে খুলবে।

## ছবি যোগ করা
Parts এর আসল ছবি `img/parts/01.jpg` থেকে `30.jpg` নামে রাখুন (১ = Standard, ২ = Ledger, ৩ = Transom ...)। ছবি না থাকলে আঁকা 3D চিত্র দেখায়।

## নতুন সংস্করণ দিলে
`sw.js` এর প্রথম লাইনে `scaf-v3` এর সংখ্যা বাড়ান (যেমন `scaf-v3`), তাহলে ব্যবহারকারীরা নতুন ফাইল পাবে।

## গুরুত্বপূর্ণ সতর্কতা
- এই অ্যাপ শেখার জন্য। সব মাপ, লোড ও ওজন শিক্ষামূলক উদাহরণ; কারখানার স্পেসিফিকেশন, অনুমোদিত ডিজাইন ও সাইটের নিয়মের বিকল্প নয়।
- Aramco অংশ GI 8.001 (ইস্যু ২৮/০৬/২০০৪) থেকে। নতুন সংস্করণ বা আপনার সাইটের নিয়ম আগে দেখুন।
- অ্যাপের Admin ছবি-আপলোড শুধু ওই ডিভাইসের ব্রাউজারে সেভ হয় এবং এটি আসল নিরাপত্তা নয়। সবাইকে ছবি দেখাতে ফাইল আপলোড করুন।

## Disclaimer (English)
Educational use only. Always follow the manufacturer's specification, approved scaffold design and your site/company procedure.
