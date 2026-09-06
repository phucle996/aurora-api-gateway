export interface RuleConditionItem {
  field: string;
  operator: string;
  value: string;
  headerName?: string;
}

export interface ModifiedFieldItem {
  icon: 'filter' | 'shield' | 'code' | 'file-text' | 'layers';
  title: string;
  subtext: string;
}

export interface AuditTrailItem {
  title: string;
  subtitle: string;
  actorDate: string;
  type: 'blue' | 'green';
}

export interface DeploymentInfo {
  deployedAt: string;
  deployedBy: string;
  environment: string;
  nodes: string;
}

export interface RuleVersion {
  version: number;
  versionLabel: string;
  dateTime: string;
  changedBy: string;
  changeType: 'Logic Update' | 'Condition Update' | 'Initial Creation' | 'Rollback Restore';
  summaryOfChanges: string;
  deploymentStatus: 'Active' | 'Archived';
  description: string;
  action: string;
  responseCode: number;
  policy: string;
  priority: number;
  conditions: RuleConditionItem[];
  modifiedFields: ModifiedFieldItem[];
  deploymentInfo: DeploymentInfo;
  auditTrail: AuditTrailItem[];
  rawJson?: string;
}
