const names = value => String(value || '').split(/\s*(?:;|\band\b)\s*/i).map(name => name.trim()).filter(Boolean);
const key = name => name.toLocaleLowerCase();
const roles = {speaker:'speakerEntityIds', chair:'chairEntityIds', author:'authorEntityIds'};

/** Keep appearance identities by name, never by their former array position. */
export function reconcileAppearanceNames(row, role, previousNames, updatedNames) {
  const field = roles[role];
  if (!field) return;
  const before = names(previousNames), after = names(updatedNames);
  const oldIds = row[field] || [], oldAssignments = row.personIdentityAssignments?.[role] || {};
  const used = new Set(), ids = [], assignments = {};
  for (const [index, name] of after.entries()) {
    const oldIndex = before.findIndex((previous, candidate) => !used.has(candidate) && key(previous) === key(name));
    if (oldIndex < 0) continue;
    used.add(oldIndex);
    if (oldIds[oldIndex]) ids[index] = oldIds[oldIndex];
    if (oldAssignments[oldIndex]) assignments[index] = {...oldAssignments[oldIndex]};
  }
  row[field] = ids;
  if (row.personIdentityAssignments) {
    if (Object.keys(assignments).length) row.personIdentityAssignments[role] = assignments;
    else delete row.personIdentityAssignments[role];
  }
  delete row.personIdentityResolvedNames;
  delete row.personIdentityIssues;
  delete row.personIdentityCandidates;
  delete row.personIdentityCandidatesByName;
  delete row.personIdentityConflict;
  delete row.personIdentityResolved;
}
