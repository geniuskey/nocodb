export const overrideFeature = async (_options: {
  workspace_id: string;
  feature: string;
  allowed: boolean;
}) => {
  return { restore: async () => {} };
};
