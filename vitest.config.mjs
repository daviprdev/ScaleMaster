import { fileURLToPath } from "node:url";

// Mesmo atalho "@/..." do tsconfig, para os testes importarem módulos do app.
export default {
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
};
