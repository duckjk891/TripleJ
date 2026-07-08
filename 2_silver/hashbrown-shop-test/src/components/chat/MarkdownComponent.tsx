import Markdown from 'react-markdown';

export const MarkdownComponent = (props: { children: string }) => {
  return <Markdown>{props.children}</Markdown>;
};
