import { mock } from 'jest-mock-extended';
import type { MetaService } from '~/meta/meta.service';
import { BasesService } from '~/services/bases.service';
import { UsersService } from '~/services/users/users.service';
import { AppHooksService } from '~/services/app-hooks/app-hooks.service';
import { MailService } from '~/services/mail/mail.service';

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(() => {
    service = new UsersService(
      mock<MetaService>(),
      mock<AppHooksService>(),
      mock<BasesService>(),
      mock<MailService>(),
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
