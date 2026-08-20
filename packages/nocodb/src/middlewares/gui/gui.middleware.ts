import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import express from 'express';
import path from 'node:path';
import type { NestMiddleware } from '@nestjs/common';
import type { AppConfig } from '~/interface/config';

@Injectable()
export class GuiMiddleware implements NestMiddleware {
  private readonly router = express.Router();

  constructor(configService: ConfigService<AppConfig>) {
    const dashboardPath = configService.get('dashboardPath', {
      infer: true,
    });
    this.router.use(
      dashboardPath,
      express.static(path.join(__dirname, 'nc-gui')),
    );
  }

  use(req: any, res: any, next: () => void) {
    this.router(req, res, next);
  }
}
