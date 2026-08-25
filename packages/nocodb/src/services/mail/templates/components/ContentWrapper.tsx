import { Container, Hr, Section, Text } from '@react-email/components';
import * as React from 'react';

export const ContentWrapper = ({
  children,
  disableContainerPadding,
}: {
  children: React.ReactNode;
  disableContainerPadding?: boolean;
}) => {
  return (
    <Container className="px-3 mt-16 !my-0 max-w-[480px]">
      <Section className="py-6 m-auto bg-gray-50 border border-gray-200 border-solid rounded-t-xl">
        <Text className="text-indigo-900 text-2xl font-bold text-center !my-0">
          RowWeave
        </Text>
      </Section>
      <Section
        className={`border border-gray-200 border-solid border-t-0 rounded-b-xl bg-white ${
          disableContainerPadding ? 'p-0' : 'p-6'
        }`}
      >
        {children}
      </Section>

      <Hr className="!my-16" />
    </Container>
  );
};
