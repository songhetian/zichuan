import { getEmployees } from "@/actions/employee.actions";
import { getDepartments } from "@/actions/department.actions";
import { EmployeeListClient } from "./employee-list-client";

export default async function EmployeesPage() {
  const [employeesResult, departmentsResult] = await Promise.all([
    getEmployees({}),
    getDepartments(),
  ]);

  const employees = employeesResult.success ? employeesResult.data : [];
  const departments = departmentsResult.success ? departmentsResult.data : [];

  return <EmployeeListClient employees={employees} departments={departments} />;
}
