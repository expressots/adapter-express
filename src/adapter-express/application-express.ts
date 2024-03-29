import express, { Request, Response, NextFunction } from "express";
import { Container } from "inversify";
import { provide } from "inversify-binding-decorators";
import process from "process";
import {
  Console,
  IApplicationMessageToConsole,
  IMiddleware,
  Middleware,
  Logger,
  IHandlebars,
  RenderTemplateOptions,
} from "@expressots/core";
import { IApplicationExpress } from "./application-express.interface";
import { InversifyExpressServer } from "./express-utils/inversify-express-server";
import { ApplicationBase } from "./application-base";

/**
 * ExpressHandler Type
 *
 * The ExpressHandler type is a union type that represents various types of Express middleware functions.
 * It can be one of the following types:
 * - express.ErrorRequestHandler: Handles errors in the middleware pipeline.
 * - express.RequestParamHandler: Handles parameters in the middleware pipeline.
 * - express.RequestHandler: General request handler.
 * - undefined: Represents the absence of a handler.
 */
type ExpressHandler =
  | express.ErrorRequestHandler
  | express.RequestParamHandler
  | express.RequestHandler
  | undefined;

/**
 * MiddlewareConfig Interface
 *
 * The MiddlewareConfig interface specifies the structure for middleware configuration objects.
 * - path: Optional. The route path for which the middleware is configured.
 * - middlewares: An array of ExpressHandler types that make up the middleware pipeline for the route specified by 'path'.
 */
type MiddlewareConfig = {
  path?: string;
  middlewares: Array<ExpressHandler>;
};

/**
 * Expresso middleware interface.
 */
interface IExpressoMiddleware {
  //readonly name: string;
  use(req: Request, res: Response, next: NextFunction): Promise<void> | void;
}

/**
 * Abstract class for creating custom Expresso middleware.
 * Custom middleware classes should extend this class and implement the use method.
 *
 */
abstract class ExpressoMiddleware implements IExpressoMiddleware {
  get name(): string {
    return this.constructor.name;
  }

  abstract use(req: Request, res: Response, next: NextFunction): Promise<void> | void;
}

/**
 * Enum representing possible server environments.
 */
enum ServerEnvironment {
  Development = "development",
  Production = "production",
}

/**
 * The Application class provides a way to configure and manage an Express application.
 * @provide Application
 */
@provide(ApplicationExpress)
class ApplicationExpress extends ApplicationBase implements IApplicationExpress {
  private app: express.Application;
  private port: number;
  private environment: ServerEnvironment;
  private container: Container;
  private middlewares: Array<ExpressHandler> = [];
  private globalPrefix: string | undefined;

  protected configureServices(): void | Promise<void> {}
  protected postServerInitialization(): void | Promise<void> {}
  protected serverShutdown(): void | Promise<void> {}

  /**
   * Handles process exit by calling serverShutdown and then exiting the process.
   */
  private handleExit(): void {
    this.serverShutdown();
    process.exit(0);
  }

  /**
   * Configures the Express application with the provided middleware entries.
   * @param app - The Express application instance.
   * @param middlewareEntries - An array of Express middleware entries to be applied.
   */
  private async configureMiddleware(
    app: express.Application,
    middlewareEntries: Array<ExpressHandler | MiddlewareConfig | ExpressoMiddleware>,
  ): Promise<void> {
    for (const entry of middlewareEntries) {
      if (typeof entry === "function") {
        app.use(entry as express.RequestHandler);
        // eslint-disable-next-line no-prototype-builtins
      } else if (entry?.hasOwnProperty("path")) {
        const { path, middlewares } = entry as MiddlewareConfig;
        for (const mid of middlewares) {
          if (path) {
            if (typeof mid === "function") {
              app.use(path, mid as express.RequestHandler);
            } else {
              const middleware = mid as unknown as ExpressoMiddleware;
              middleware.use = middleware.use.bind(middleware);
              app.use(path, middleware.use);
            }
          }
        }
      } else {
        const middleware = entry as ExpressoMiddleware;
        middleware.use = middleware.use.bind(middleware);
        app.use(middleware.use);
      }
    }
  }

  /**
   * Create and configure the Express application.
   * @param container - The InversifyJS container.
   * @param middlewares - An array of Express middlewares to be applied.
   * @returns The configured Application instance.
   */
  private async init(
    container: Container,
    middlewares: Array<express.RequestHandler> = [],
  ): Promise<ApplicationExpress> {
    await this.configureServices();

    const middleware = container.get<IMiddleware>(Middleware);
    const sortedMiddlewarePipeline = middleware.getMiddlewarePipeline();
    const pipeline = sortedMiddlewarePipeline.map((entry) => entry.middleware);

    this.middlewares.push(...middlewares, ...(pipeline as Array<ExpressHandler>));

    const expressServer = new InversifyExpressServer(container, null, {
      rootPath: this.globalPrefix as string,
    });

    expressServer.setConfig((app: express.Application) => {
      this.configureMiddleware(app, this.middlewares);
    });

    expressServer.setErrorConfig((app: express.Application) => {
      if (middleware.getErrorHandler()) {
        app.use(middleware.getErrorHandler() as express.ErrorRequestHandler);
      }
    });

    this.app = expressServer.build();
    return this;
  }

  /**
   * Create and configure the Express application.
   * @param container - The InversifyJS container.
   * @param middlewares - An array of Express middlewares to be applied.
   * @returns The configured Application instance.
   */
  public async create(
    container: Container,
    middlewares: Array<ExpressHandler> = [],
  ): Promise<ApplicationExpress> {
    this.container = container;
    this.middlewares = middlewares;
    this.globalPrefix = this.globalPrefix || "/";

    return this;
  }

  /**
   * Start listening on the given port and environment.
   * @param port - The port number to listen on.
   * @param environment - The server environment.
   * @param consoleMessage - Optional message to display in the console.
   */
  public async listen(
    port: number,
    environment: ServerEnvironment,
    consoleMessage?: IApplicationMessageToConsole,
  ): Promise<void> {
    /* Initializes the application and executes the middleware pipeline */
    await this.init(this.container, this.middlewares as Array<express.RequestHandler>);

    /* Sets the port and environment */
    this.port = port;
    this.environment = environment;
    this.app.set("env", environment);

    this.app.listen(this.port, () => {
      const console: Console = this.container.get<Console>(Console);
      console.messageServer(this.port, this.environment, consoleMessage);

      (["SIGTERM", "SIGHUP", "SIGBREAK", "SIGQUIT", "SIGINT"] as Array<NodeJS.Signals>).forEach(
        (signal) => {
          process.on(signal, this.handleExit.bind(this));
        },
      );
    });

    await Promise.resolve(this.postServerInitialization());
  }

  /**
   * Sets the global route prefix for the application.
   *
   * @public
   * @method setGlobalRoutePrefix
   *
   * @param {string} prefix - The prefix to use for all routes.
   *
   */
  public setGlobalRoutePrefix(prefix: string): void {
    this.globalPrefix = prefix;
  }

  /**
   * Configures the application's view engine based on the provided configuration options.
   *
   * @public
   * @method setEngine
   * @template T - A generic type extending from RenderTemplateOptions.
   *
   * @param {T} options - An object of type T (must be an object that extends RenderTemplateOptions)
   *                      that provides the configuration options for setting the view engine.
   *                      This includes the extension name, view path, and the engine function itself.
   */
  public setEngine<T extends RenderTemplateOptions>(options: T): void {
    if ("extName" in options) {
      const { extName, viewPath, engine } = options as IHandlebars;
      this.app.engine(extName, engine);
      this.app.set("view engine", extName);
      this.app.set("views", viewPath);
    }
  }

  /**
   * Verifies if the current environment is development.
   *
   * @returns A boolean value indicating whether the current environment is development or not.
   */
  protected isDevelopment(): boolean {
    if (this.app) {
      return this.app.get("env") === ServerEnvironment.Development;
    }

    this.container
      .get<Logger>(Logger)
      .error("isDevelopment() method must be called on `PostServerInitialization`", "application");
    return false;
  }

  /**
   * Verifies if the current environment is production.
   *
   * @returns A boolean value indicating whether the current environment is production or not.
   *
   */
  public get ExpressApp(): express.Application {
    return this.app;
  }
}

export { ApplicationExpress as AppExpress, ServerEnvironment };
