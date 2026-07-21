/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  // Preflight (Tailwind's global CSS reset) is OFF: the rest of the app has its
  // own complete stylesheet (APP_STYLES) and preflight would disturb it (form
  // controls, inline SVG icons, margins). The login/reset pages re-apply the
  // small slice of reset they need, scoped to .tw-scope — see src/index.css.
  corePlugins: { preflight: false },
  theme: {
    extend: {},
  },
  plugins: [],
};
