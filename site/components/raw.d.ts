// A file imported with `?raw`, which the site's build (Vite) reads in as its text.
declare module "*?raw" {
  const text: string;
  export default text;
}
