import * as vscode from 'vscode';

export interface UsageModel {
  model: string;
  includedRequests: number;
  billedRequests: number;
  grossAmount: number;
  billedAmount: number;
}

export interface UsageData {
  totalUsage: number;
  limit: number;
  billedTotal: number;
  models: UsageModel[];
  dateRange: string;
}

const STORAGE_KEY_MODELS = 'copilotTracker.models';
const STORAGE_KEY_LIMIT = 'copilotTracker.limit';
const DEFAULT_LIMIT = 300;
export const COST_PER_REQUEST = 0.04;

export class ManualDataService {
  constructor(private readonly globalState: vscode.Memento) {}

  getUsageData(): UsageData {
    const models = this.getModels();
    const limit = this.getLimit();
    const totalUsage = models.reduce((sum, m) => sum + m.includedRequests, 0);
    const billedTotal = models.reduce((sum, m) => sum + m.billedAmount, 0);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const fmt = (d: Date) =>
      d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    return {
      totalUsage: parseFloat(totalUsage.toFixed(2)),
      limit,
      billedTotal: parseFloat(billedTotal.toFixed(2)),
      models,
      dateRange: `${fmt(monthStart)} – ${fmt(now)}`,
    };
  }

  getModels(): UsageModel[] {
    return this.globalState.get<UsageModel[]>(STORAGE_KEY_MODELS, []);
  }

  getLimit(): number {
    return this.globalState.get<number>(STORAGE_KEY_LIMIT, DEFAULT_LIMIT);
  }

  async addModel(model: UsageModel): Promise<void> {
    model.grossAmount = parseFloat(
      ((model.includedRequests + model.billedRequests) * COST_PER_REQUEST).toFixed(2),
    );
    const models = this.getModels();
    const existing = models.findIndex(
      (m) => m.model.toLowerCase() === model.model.toLowerCase(),
    );
    if (existing >= 0) {
      models[existing] = model;
    } else {
      models.push(model);
    }
    await this.globalState.update(STORAGE_KEY_MODELS, models);
  }

  async removeModel(modelName: string): Promise<void> {
    const models = this.getModels().filter(
      (m) => m.model.toLowerCase() !== modelName.toLowerCase(),
    );
    await this.globalState.update(STORAGE_KEY_MODELS, models);
  }

  async setLimit(limit: number): Promise<void> {
    await this.globalState.update(STORAGE_KEY_LIMIT, limit);
  }

  async resetData(): Promise<void> {
    await this.globalState.update(STORAGE_KEY_MODELS, []);
    await this.globalState.update(STORAGE_KEY_LIMIT, DEFAULT_LIMIT);
  }
}
