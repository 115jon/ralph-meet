import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { NotFoundPage, RouteErrorPage } from "./components/PageState";
import { routeTree } from "./routeTree.gen";

export function createRouter() {
  return createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    // Themed boundaries; neither renders error.message to the visitor.
    defaultErrorComponent: RouteErrorPage,
    defaultNotFoundComponent: NotFoundPage,
  });
}

// TanStack Start SSR entry expects getRouter
export const getRouter = createRouter;

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createRouter>;
  }
}
