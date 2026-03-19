export interface ToolPromptMeta {
  description: string;
  parameters: Record<string, string>;
}

export interface FileToolPromptRegistry {
  read_file: ToolPromptMeta;
  list_files: ToolPromptMeta;
  write_file: ToolPromptMeta;
}

export interface TimeToolPromptRegistry {
  get_current_time: ToolPromptMeta;
}

export interface BrowserToolPromptRegistry {
  browse_url: ToolPromptMeta;
}

export interface SearchToolPromptRegistry {
  search_web: ToolPromptMeta;
}

export interface PromptRegistry {
  system: {
    base: string;
    behavior: string;
    fileToolRules: string;
    workspacePathRules: string;
  };
  workspace: {
    bootstrap: string;
  };
  runtime: {
    fileToolEnforcement: string;
    fileToolRequiredMessage: string;
    adviceOnlyDegrade: string;
    modelCapabilityDegrade: string;
    planApprovalMessage: string;
    planSummarySingle: string;
    planSummaryMultiple: string;
  };
  tools: {
    time: TimeToolPromptRegistry;
    browser: BrowserToolPromptRegistry;
    search: SearchToolPromptRegistry;
    file: FileToolPromptRegistry;
  };
}
