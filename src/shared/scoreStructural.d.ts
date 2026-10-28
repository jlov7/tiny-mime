declare const validate: {
  (value: unknown): boolean;
  errors: { keyword: string; instancePath: string }[] | null;
};
export default validate;
