// src/worker/worker.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PortalCheckProcessor } from './processors/portal-check.processor';
import { AccountMaintenanceProcessor } from './processors/account-maintenance.processor'; // 🌟 Nạp con hàng mới đúc
import { AutomationModule } from '../automation/automation.module';
import { BrokersModule } from './brokers/brokers.module';
@Module({
  imports: [
    BullModule.registerQueue(
      {
        name: 'portal-checks',
      },
      {
        name: 'account-maintenance',
      },
      {
        name: 'global-task-results',
      },
    ),
    AutomationModule,
    BrokersModule,
  ],
  providers: [PortalCheckProcessor, AccountMaintenanceProcessor],
})
export class WorkerModule {}
