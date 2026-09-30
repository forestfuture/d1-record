// Single-file components, such as the llms plugin's Copy page button.
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent;
  export default component;
}
