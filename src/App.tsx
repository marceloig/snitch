import { useState, useEffect, useCallback } from "react";
import { useAuthenticator } from "@aws-amplify/ui-react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../amplify/data/resource";

import AppLayout from "@cloudscape-design/components/app-layout";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Container from "@cloudscape-design/components/container";
import Input from "@cloudscape-design/components/input";
import Button from "@cloudscape-design/components/button";
import Table from "@cloudscape-design/components/table";
import Box from "@cloudscape-design/components/box";
import Checkbox from "@cloudscape-design/components/checkbox";
import TopNavigation from "@cloudscape-design/components/top-navigation";

const client = generateClient<Schema>();

type Todo = Schema["Todo"]["type"];

function App() {
  const { user, signOut } = useAuthenticator();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [newTodo, setNewTodo] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchTodos = useCallback(async () => {
    setLoading(true);
    const { data } = await client.models.Todo.list({});
    setTodos(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTodos();
  }, [fetchTodos]);

  async function createTodo() {
    if (!newTodo.trim()) return;
    await client.models.Todo.create({
      content: newTodo,
      done: false,
    });
    setNewTodo("");
    fetchTodos();
  }

  async function toggleTodo(todo: Todo) {
    await client.models.Todo.update({
      id: todo.id,
      done: !todo.done,
    });
    fetchTodos();
  }

  async function deleteTodo(id: string) {
    await client.models.Todo.delete({ id });
    fetchTodos();
  }

  return (
    <>
      <TopNavigation
        identity={{ href: "/", title: "Amplify + Cloudscape App" }}
        utilities={[
          {
            type: "button",
            text: user?.signInDetails?.loginId ?? "User",
            iconName: "user-profile",
          },
          {
            type: "button",
            text: "Sign out",
            onClick: signOut,
          },
        ]}
      />
      <AppLayout
        navigationHide
        toolsHide
        content={
          <ContentLayout
            header={
              <Header variant="h1" description="Manage your tasks">
                My Todos
              </Header>
            }
          >
            <SpaceBetween size="l">
              <Container header={<Header variant="h2">Add a new todo</Header>}>
                <SpaceBetween direction="horizontal" size="xs">
                  <Input
                    value={newTodo}
                    onChange={({ detail }) => setNewTodo(detail.value)}
                    placeholder="Enter a new todo..."
                    onKeyDown={({ detail }) => {
                      if (detail.key === "Enter") createTodo();
                    }}
                  />
                  <Button variant="primary" onClick={createTodo}>
                    Add
                  </Button>
                </SpaceBetween>
              </Container>

              <Table
                columnDefinitions={[
                  {
                    id: "done",
                    header: "Done",
                    cell: (item) => (
                      <Checkbox
                        checked={item.done ?? false}
                        onChange={() => toggleTodo(item)}
                      />
                    ),
                    width: 80,
                  },
                  {
                    id: "content",
                    header: "Content",
                    cell: (item) => item.content ?? "",
                  },
                  {
                    id: "actions",
                    header: "Actions",
                    cell: (item) => (
                      <Button
                        variant="inline-link"
                        onClick={() => deleteTodo(item.id)}
                      >
                        Delete
                      </Button>
                    ),
                    width: 120,
                  },
                ]}
                items={todos}
                loading={loading}
                loadingText="Loading todos..."
                empty={
                  <Box textAlign="center" color="inherit">
                    <b>No todos</b>
                    <Box padding={{ bottom: "s" }} variant="p" color="inherit">
                      Create your first todo to get started.
                    </Box>
                  </Box>
                }
                header={<Header variant="h2">Todos</Header>}
              />
            </SpaceBetween>
          </ContentLayout>
        }
      />
    </>
  );
}

export default App;
