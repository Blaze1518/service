// src/worker/brokers/brokers.module.ts
import { Module } from '@nestjs/common';
import { AccountSessionBroker } from './account-session-broker.service';

@Module({
  imports: [],
  providers: [AccountSessionBroker],
  exports: [AccountSessionBroker],
})
export class BrokersModule {}
