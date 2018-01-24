import * as React from 'react'
import * as classNames from 'classnames'
import {
  AutocompletingTextArea,
  AutocompletingInput,
  IAutocompletionProvider,
} from '../autocompletion'
import { CommitIdentity } from '../../models/commit-identity'
import { ICommitMessage } from '../../lib/app-state'
import { Dispatcher } from '../../lib/dispatcher'
import { IGitHubUser } from '../../lib/databases/github-user-database'
import { Repository } from '../../models/repository'
import { Button } from '../lib/button'
import { Avatar } from '../lib/avatar'
import { Loading } from '../lib/loading'
import { structuralEquals } from '../../lib/equality'
import { generateGravatarUrl } from '../../lib/gravatar'
import { AuthorInput, IAuthor } from '../lib/author-input'
import { FocusContainer } from '../lib/focus-container'
import { showContextualMenu, IMenuItem } from '../main-process-proxy'
import { Octicon, OcticonSymbol } from '../octicons'

const authorIcon = new OcticonSymbol(
  12,
  7,
  'M9.875 2.125H12v1.75H9.875V6h-1.75V3.875H6v-1.75h2.125V0h1.75v2.125zM6 ' +
    '6.5a.5.5 0 0 1-.5.5h-5a.5.5 0 0 1-.5-.5V6c0-1.316 2-2 2-2s.114-.204 ' +
    '0-.5c-.42-.31-.472-.795-.5-2C1.587.293 2.434 0 3 0s1.413.293 1.5 1.5c-.028 ' +
    '1.205-.08 1.69-.5 2-.114.295 0 .5 0 .5s2 .684 2 2v.5z'
)

interface ICommitMessageProps {
  readonly onCreateCommit: (message: ICommitMessage) => Promise<boolean>
  readonly branch: string | null
  readonly commitAuthor: CommitIdentity | null
  readonly gitHubUser: IGitHubUser | null
  readonly anyFilesSelected: boolean
  readonly commitMessage: ICommitMessage | null
  readonly contextualCommitMessage: ICommitMessage | null
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  readonly autocompletionProviders: ReadonlyArray<IAutocompletionProvider<any>>
  readonly isCommitting: boolean

  /**
   * Whether or not to show a field for adding co-authors to
   * a commit (currently only supported for GH/GHE repositories)
   */
  readonly showCoAuthoredBy: boolean

  /**
   * Callback for when the user has chosen to hide or show the
   * co-authors field
   */
  readonly onShowCoAuthoredByChanged: (showCoAuthoredBy: boolean) => void
}

interface ICommitMessageState {
  readonly summary: string
  readonly description: string | null

  /** The last contextual commit message we've received. */
  readonly lastContextualCommitMessage: ICommitMessage | null
}

export class CommitMessage extends React.Component<
  ICommitMessageProps,
  ICommitMessageState
> {
  private descriptionComponent: AutocompletingTextArea | null = null

  public constructor(props: ICommitMessageProps) {
    super(props)

    this.state = {
      summary: '',
      description: '',
      lastContextualCommitMessage: null,
    }
  }

  public componentWillMount() {
    this.receiveProps(this.props, true)
  }

  public componentWillUnmount() {
    // We're unmounting, likely due to the user switching to the history tab.
    // Let's persist our commit message in the dispatcher.
    this.props.dispatcher.setCommitMessage(this.props.repository, this.state)
  }

  public componentWillReceiveProps(nextProps: ICommitMessageProps) {
    this.receiveProps(nextProps, false)
  }

  private receiveProps(nextProps: ICommitMessageProps, initializing: boolean) {
    // If we're switching away from one repository to another we'll persist
    // our commit message in the dispatcher.
    if (nextProps.repository.id !== this.props.repository.id) {
      this.props.dispatcher.setCommitMessage(this.props.repository, this.state)
    }

    // This is rather gnarly. We want to persist the commit message (summary,
    // and description) in the dispatcher on a per-repository level (git-store).
    //
    // Our dispatcher is asynchronous and only emits and update on animation
    // frames. This is a great thing for performance but it gets real messy
    // when you throw text boxes into the mix. If we went for a traditional
    // approach of persisting the textbox values in the dispatcher and updating
    // the virtual dom when we get new props there's an interim state which
    // means that the browser can't keep track of the cursor for us, see:
    //
    //   http://stackoverflow.com/a/28922465
    //
    // So in order to work around that we keep the text values in the component
    // state. Whenever they get updated we submit the update to the dispatcher
    // but we disregard the message that flows to us on the subsequent animation
    // frame unless we have switched repositories.
    //
    // Then there's the case when we're being mounted (think switching between
    // history and changes tabs. In that case we have to rely on what's in the
    // dispatcher since we don't have any state of our own.

    const nextContextualCommitMessage = nextProps.contextualCommitMessage
    const lastContextualCommitMessage = this.state.lastContextualCommitMessage
    // If the contextual commit message changed, we'll use it as our commit
    // message.
    if (
      nextContextualCommitMessage &&
      (!lastContextualCommitMessage ||
        !structuralEquals(
          nextContextualCommitMessage,
          lastContextualCommitMessage
        ))
    ) {
      this.setState({
        summary: nextContextualCommitMessage.summary,
        description: nextContextualCommitMessage.description,
        lastContextualCommitMessage: nextContextualCommitMessage,
      })
    } else if (
      initializing ||
      this.props.repository.id !== nextProps.repository.id
    ) {
      // We're either initializing (ie being mounted) or someone has switched
      // repositories. If we receive a message we'll take it
      if (nextProps.commitMessage) {
        // Don't update dispatcher here, we're receiving it, could cause never-
        // ending loop.
        this.setState({
          summary: nextProps.commitMessage.summary,
          description: nextProps.commitMessage.description,
          lastContextualCommitMessage: nextContextualCommitMessage,
        })
      } else {
        // No message, assume clean slate
        this.setState({
          summary: '',
          description: null,
          lastContextualCommitMessage: nextContextualCommitMessage,
        })
      }
    } else {
      this.setState({
        lastContextualCommitMessage: nextContextualCommitMessage,
      })
    }
  }

  private clearCommitMessage() {
    this.setState({ summary: '', description: null })
  }

  private onSummaryChanged = (summary: string) => {
    this.setState({ summary })
  }

  private onDescriptionChanged = (description: string) => {
    this.setState({ description })
  }

  private onSubmit = () => {
    this.createCommit()
  }

  private async createCommit() {
    if (!this.canCommit) {
      return
    }

    const success = await this.props.onCreateCommit({
      // We know that summary is non-null thanks to canCommit
      summary: this.state.summary!,
      description: this.state.description,
    })

    if (success) {
      this.clearCommitMessage()
    }
  }

  private canCommit(): boolean {
    return (
      this.props.anyFilesSelected &&
      this.state.summary !== null &&
      this.state.summary.length > 0
    )
  }

  private onKeyDown = (event: React.KeyboardEvent<Element>) => {
    const isShortcutKey = __DARWIN__ ? event.metaKey : event.ctrlKey
    if (isShortcutKey && event.key === 'Enter' && this.canCommit()) {
      this.createCommit()
      event.preventDefault()
    }
  }

  private renderAvatar() {
    const commitAuthor = this.props.commitAuthor
    const avatarTitle = commitAuthor
      ? `Committing as ${commitAuthor.name} <${commitAuthor.email}>`
      : undefined
    let avatarUser = undefined

    if (commitAuthor) {
      const avatarURL = this.props.gitHubUser
        ? this.props.gitHubUser.avatarURL
        : generateGravatarUrl(commitAuthor.email)

      avatarUser = {
        email: commitAuthor.email,
        name: commitAuthor.name,
        avatarURL,
      }
    }

    return <Avatar user={avatarUser} title={avatarTitle} />
  }

  private get isCoAuthorInputEnabled() {
    return (
      this.props.showCoAuthoredBy &&
      this.props.repository.gitHubRepository !== null
    )
  }

  private onAuthorsUpdated = (authors: ReadonlyArray<IAuthor>) => {
    console.log('authors updated', authors.map(a => a.username))
  }

  private renderCoAuthorInput() {
    if (!this.isCoAuthorInputEnabled) {
      return null
    }

    return (
      <AuthorInput
        autocompletionProviders={this.props.autocompletionProviders}
        onAuthorsUpdated={this.onAuthorsUpdated}
        authors={[
          {
            name: 'Markus Olsson',
            email: 'niik@github.com',
            username: 'niik',
          },
          {
            name: 'Don Okuda',
            email: 'donokuda@github.com',
            username: 'donokuda',
          },
        ]}
      />
    )
  }

  private onToggleCoAuthors = () => {
    this.props.onShowCoAuthoredByChanged(!this.props.showCoAuthoredBy)
  }

  private get toggleCoAuthorsText(): string {
    return this.props.showCoAuthoredBy
      ? __DARWIN__ ? 'Hide Co-Authors' : 'Hide co-authors'
      : __DARWIN__ ? 'Show Co-Authors' : 'Show co-authors'
  }

  private onContextMenu = (event: React.MouseEvent<any>) => {
    event.preventDefault()

    const items: IMenuItem[] = [
      {
        label: this.toggleCoAuthorsText,
        action: this.onToggleCoAuthors,
        enabled: this.props.repository.gitHubRepository !== null,
      },
    ]

    showContextualMenu(items)
  }

  private onCoAuthorToggleButtonClick = (
    e: React.MouseEvent<HTMLDivElement>
  ) => {
    e.preventDefault()
    this.onToggleCoAuthors()
  }

  private renderCoAuthorToggleButton() {
    if (this.props.repository.gitHubRepository === null) {
      return null
    }

    return (
      <div
        role="button"
        className="co-authors-toggle"
        onClick={this.onCoAuthorToggleButtonClick}
        tabIndex={-1}
        aria-label={this.toggleCoAuthorsText}
      >
        <Octicon symbol={authorIcon} />
      </div>
    )
  }

  private onDescriptionFieldRef = (
    component: AutocompletingTextArea | null
  ) => {
    this.descriptionComponent = component
  }

  private onFocusContainerClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (this.descriptionComponent) {
      this.descriptionComponent.focus()
    }
  }

  public render() {
    const branchName = this.props.branch ? this.props.branch : 'master'
    const buttonEnabled = this.canCommit() && !this.props.isCommitting

    const loading = this.props.isCommitting ? <Loading /> : undefined
    const className = classNames({
      'with-co-authors': this.isCoAuthorInputEnabled,
    })

    return (
      <div
        id="commit-message"
        role="group"
        aria-label="Create commit"
        className={className}
        onContextMenu={this.onContextMenu}
      >
        <div className="summary">
          {this.renderAvatar()}

          <AutocompletingInput
            className="summary-field"
            placeholder="Summary"
            value={this.state.summary}
            onValueChanged={this.onSummaryChanged}
            onKeyDown={this.onKeyDown}
            autocompletionProviders={this.props.autocompletionProviders}
          />
        </div>

        <FocusContainer
          className="description-focus-container"
          onClick={this.onFocusContainerClick}
        >
          <AutocompletingTextArea
            className="description-field"
            placeholder="Description"
            value={this.state.description || ''}
            onValueChanged={this.onDescriptionChanged}
            onKeyDown={this.onKeyDown}
            autocompletionProviders={this.props.autocompletionProviders}
            ref={this.onDescriptionFieldRef}
          />
          <div className="action-bar">{this.renderCoAuthorToggleButton()}</div>
        </FocusContainer>

        {this.renderCoAuthorInput()}

        <Button
          type="submit"
          className="commit-button"
          onClick={this.onSubmit}
          disabled={!buttonEnabled}
        >
          {loading}
          <span title={`Commit to ${branchName}`}>
            {loading ? 'Committing' : 'Commit'} to <strong>{branchName}</strong>
          </span>
        </Button>
      </div>
    )
  }
}
