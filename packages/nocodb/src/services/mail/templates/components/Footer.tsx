import {
  Column,
  Container,
  Link,
  Row,
  Section,
  Text,
} from '@react-email/components';
import * as React from 'react';

export const Footer = () => {
  return (
    <Container className="px-3">
      <Text className="text-gray-500 m-auto text-sm max-w-[400px] text-center">
        RowWeave is an independent, community-led AGPL no-code base platform.
      </Text>
      <Section className="mt-6">
        <Row className="max-w-[300px] m-auto">
          <Column className="pr-2">
            <Link
              href="https://github.com/geniuskey/rowweave"
              target="_blank"
            >
              <Text className="text-center underline py-0 !my-0 text-gray-500 text-[13px]">
                Project
              </Text>
            </Link>
          </Column>
          <Column className="px-2">
            <Link
              href="https://github.com/geniuskey/rowweave/tree/foundation/docs"
              target="_blank"
            >
              <Text className="text-center underline py-0 !my-0 text-gray-500 text-[13px]">
                Docs
              </Text>
            </Link>
          </Column>
          <Column className="pl-2">
            <Link
              href="https://github.com/geniuskey/rowweave/blob/foundation/LICENSE"
              target="_blank"
            >
              <Text className="text-center underline py-0 !my-0 text-gray-500 text-[13px]">
                AGPL License
              </Text>
            </Link>
          </Column>
        </Row>
        <Row className="mt-6">
          <Column>
            <Text className="text-center !my-0 text-gray-500 text-[13px]">
              RowWeave contributors
            </Text>
          </Column>
        </Row>
      </Section>
    </Container>
  );
};
