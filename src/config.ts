export const SITE = {
  website: "https://docker.raoshahzaib.site/", // replace this with your deployed domain
  author: "Rao Shahzaib",
  profile: "https://github.com/ShahzaibRao/",
  desc: "A Complete Journey through Docker's Core Concepts | Docker 360",
  title: "Docker 360",
  ogImage: "astropaper-og.jpg",
  lightAndDarkMode: true,
  postPerIndex: 4,
  postPerPage: 4,
  scheduledPostMargin: 15 * 60 * 1000, // 15 minutes
  showArchives: true,
  showBackButton: true, // show back button in post detail
  editPost: {
    enabled: true,
    text: "Edit page",
    url: "https://github.com/ShahzaibRao/docker-blog/edit/main/",
  },
  dynamicOgImage: true,
  dir: "ltr", // "rtl" | "auto"
  lang: "en", // html lang code. Set this empty and default will be "en"
  timezone: "Asia/Karachi", // Default global timezone (IANA format) https://en.wikipedia.org/wiki/List_of_tz_database_time_zones
} as const;
