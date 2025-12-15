import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errorResponse: any = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
        errorResponse = {
          statusCode: status,
          message,
          error: exception.name,
        };
      } else if (typeof exceptionResponse === 'object') {
        errorResponse = {
          statusCode: status,
          ...(exceptionResponse as object),
        };
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      errorResponse = {
        statusCode: status,
        message,
        error: 'Internal Server Error',
      };
    }

    console.error('Exception caught:', {
      status,
      message,
      path: request.url,
      method: request.method,
      errorResponse,
    });

    response.status(status).json(errorResponse);
  }
}

