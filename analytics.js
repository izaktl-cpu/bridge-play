// Umami Cloud: ספירת כניסות וזמן שהייה, בלי קוקיז ובלי נתונים אישיים.
// מזהה האתר יושב כאן בלבד, ולא בכל דף בנפרד.
(() => {
  const WEBSITE_ID = '4af93d8e-d841-4835-96c5-5518e5e342fc';

  // הרצה מקומית של המורה איציק לא נספרת בסטטיסטיקה של התלמידים.
  const host = location.hostname;
  if (location.protocol === 'file:' || host === 'localhost' || host === '127.0.0.1') return;

  const tag = document.createElement('script');
  tag.defer = true;
  tag.src = 'https://cloud.umami.is/script.js';
  tag.dataset.websiteId = WEBSITE_ID;
  document.head.appendChild(tag);
})();
