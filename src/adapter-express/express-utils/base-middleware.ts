import type { NextFunction, Request, Response } from "express";
import { interfaces as inversifyInterfaces } from "../../di/di.interfaces";
import type { HttpContext } from "./interfaces";
import { injectable } from "@expressots/core";

@injectable()
export abstract class BaseMiddleware implements BaseMiddleware {
  // httpContext is initialized when the middleware is invoked
  // see resolveMiddleware in server.ts for more details
  public httpContext!: HttpContext;

  protected bind<T>(
    serviceIdentifier: inversifyInterfaces.ServiceIdentifier<T>,
  ): inversifyInterfaces.BindingToSyntax<T> {
    return this.httpContext.container.bind(serviceIdentifier);
  }

  public abstract handler(req: Request, res: Response, next: NextFunction): void;
}
