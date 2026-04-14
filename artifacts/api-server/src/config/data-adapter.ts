export interface DataAdapter {
  getDataForSection(sectionId: string): Promise<Record<string, unknown>>;
  getFullDataContext(): Promise<string>;
}

export class StaticDataAdapter implements DataAdapter {
  private dataFn: (sectionId: string) => Record<string, unknown>;
  private contextFn: () => string;

  constructor(
    dataFn: (sectionId: string) => Record<string, unknown>,
    contextFn: () => string,
  ) {
    this.dataFn = dataFn;
    this.contextFn = contextFn;
  }

  async getDataForSection(sectionId: string): Promise<Record<string, unknown>> {
    return this.dataFn(sectionId);
  }

  async getFullDataContext(): Promise<string> {
    return this.contextFn();
  }
}
