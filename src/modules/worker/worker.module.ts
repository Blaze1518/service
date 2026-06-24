// src/worker/worker.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PortalCheckProcessor } from './processors/portal-check.processor';
import { AutomationModule } from '../automation/automation.module';

@Module({
  imports: [
    BullModule.registerQueue(
      {
        name: 'portal-checks',
      },
      {
        name: 'global-task-results',
      },
    ),
    AutomationModule,
  ],
  providers: [PortalCheckProcessor],
})
export class WorkerModule {}
