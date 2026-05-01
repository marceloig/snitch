type PolicyInput = {
  principalType: "USER" | "GROUP";
  principalId: string;
  accountIds: string[];
  ouIds: string[];
  permissionSetArns: string[];
};

/**
 * Builds a Cedar policy statement (PERMIT) for AWS Verified Permissions.
 *
 * Principal: IDC User or Group
 * Action:    "assume" (static; permission sets are encoded in the when-condition)
 * Resource:  any Account or OU entity — narrowed in the when-condition to the
 *            specific accounts and OUs selected by the admin
 *
 * Example output:
 *   permit (
 *     principal == Snitch::User::"abc-123",
 *     action == Snitch::Action::"assume",
 *     resource
 *   ) when {
 *     (
 *       resource in Snitch::Account::"111111111111" ||
 *       resource in Snitch::OU::"ou-root-xxxx"
 *     ) &&
 *     ["arn:aws:sso:::permissionSet/ps-1"].contains(context.permissionSetArn)
 *   };
 */
export function buildCedarPolicy(input: PolicyInput): string {
  const principal =
    input.principalType === "GROUP"
      ? `principal in Snitch::Group::"${input.principalId}"`
      : `principal == Snitch::User::"${input.principalId}"`;

  const resourceClauses = [
    ...input.accountIds.map((id) => `resource in Snitch::Account::"${id}"`),
    ...input.ouIds.map((id) => `resource in Snitch::OU::"${id}"`),
  ];

  const psSet = input.permissionSetArns
    .map((arn) => `"${arn}"`)
    .join(", ");
  const permSetClause = `[${psSet}].contains(context.permissionSetArn)`;

  let whenBody: string;
  if (resourceClauses.length === 0) {
    whenBody = permSetClause;
  } else if (resourceClauses.length === 1) {
    whenBody = `${resourceClauses[0]} &&\n  ${permSetClause}`;
  } else {
    const joined = resourceClauses.join(" ||\n    ");
    whenBody = `(\n    ${joined}\n  ) &&\n  ${permSetClause}`;
  }

  return [
    `permit (`,
    `  ${principal},`,
    `  action == Snitch::Action::"assume",`,
    `  resource`,
    `) when {`,
    `  ${whenBody}`,
    `};`,
  ].join("\n");
}
