declare module "bcryptjs" {
  const bcrypt: {
    hash(input: string, rounds: number): Promise<string>;
  };

  export default bcrypt;
}

declare module "@workspace/db" {
  export const db: any;
  export const usersTable: any;
}
